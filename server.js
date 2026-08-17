require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();

// ================================
// Middleware
// ================================
// Allow requests from your specific frontend URL to prevent CORS errors on Render
app.use(cors({
  origin: "*", // Or replace "*" with your frontend Netlify/Vercel URL for better security
  methods: ["GET", "POST"]
}));
app.use(express.json());

// ================================
// MongoDB Connection
// ================================
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((error) => console.error("MongoDB Connection Error:", error.message));

// ================================
// History Schema & Model
// ================================
const historySchema = new mongoose.Schema(
  {
    message: { type: String, required: true },
    totalRecipients: { type: Number, required: true },
    successful: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    results: [
      {
        email: String,
        status: String,
        accepted: [String],
        rejected: [String],
        error: String,
        messageId: String,
      },
    ],
  },
  { timestamps: true }
);

const EmailHistory = mongoose.model("EmailHistory", historySchema);

// ================================
// Email Provider Configuration
// ================================
const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || "gmail").toLowerCase().trim();
let transporter = null;

if (EMAIL_PROVIDER === "gmail") {
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS, // MUST BE AN APP PASSWORD, NOT REGULAR PASSWORD
    },
  });

  transporter.verify((error) => {
    if (error) console.error("SMTP Connection Error:", error.message);
    else console.log("Gmail SMTP Server is ready");
  });
}

// ================================
// Send Single Email Function
// ================================
async function sendSingleEmail(email, message) {
  const subject = "BulkMailer Campaign";
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
      <h2>BulkMailer</h2>
      <p>${message}</p>
      <hr />
      <small>Sent using BulkMailer Email Campaign Platform</small>
    </div>
  `;

  if (EMAIL_PROVIDER === "gmail") {
    if (!transporter) throw new Error("Gmail SMTP transporter is not initialized.");
    const info = await transporter.sendMail({
      from: { name: "BulkMailer", address: process.env.EMAIL_USER },
      to: email,
      subject: subject,
      text: message,
      html: htmlContent,
    });
    return {
      messageId: info.messageId,
      accepted: info.accepted || [email],
      rejected: info.rejected || [],
    };
  } else if (EMAIL_PROVIDER === "brevo") {
    // Brevo Logic remains identical...
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": process.env.BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "BulkMailer", email: process.env.EMAIL_USER },
        to: [{ email: email }],
        subject: subject,
        textContent: message,
        htmlContent: htmlContent,
      }),
    });
    const responseData = await response.json();
    if (!response.ok) throw new Error(responseData.message);
    return { messageId: responseData.messageId || "N/A", accepted: [email], rejected: [] };
  } else if (EMAIL_PROVIDER === "resend") {
     // Resend logic remains identical...
     const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `BulkMailer <${process.env.EMAIL_USER}>`,
          to: [email],
          subject: subject,
          text: message,
          html: htmlContent,
        }),
      });
      const responseData = await response.json();
      if (!response.ok) throw new Error(responseData.message);
      return { messageId: responseData.id || "N/A", accepted: [email], rejected: [] };
  } else {
    throw new Error(`Unsupported email provider`);
  }
}

// ================================
// Send Bulk Emails (OPTIMIZED FOR RENDER)
// ================================
app.post("/sendMail", async (req, res) => {
  try {
    const { message, recipients } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: "Email message is required" });
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ message: "No recipients provided" });
    }

    const results = [];
    
    // BATCH PROCESSING: Process 10 emails at a time concurrently
    // This prevents the Render 100-second timeout error.
    const BATCH_SIZE = 10; 
    
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      
      const batchPromises = batch.map(async (email) => {
        const cleanEmail = String(email).trim();
        if (!cleanEmail) {
          return { email: cleanEmail, status: "failed", error: "Empty email address" };
        }
        
        try {
          const info = await sendSingleEmail(cleanEmail, message);
          return { 
            email: cleanEmail, 
            status: "success", 
            accepted: info.accepted, 
            rejected: info.rejected, 
            messageId: info.messageId 
          };
        } catch (error) {
          return { email: cleanEmail, status: "failed", error: error.message };
        }
      });

      // Wait for the current batch of 10 to finish before moving to the next
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    const successCount = results.filter((item) => item.status === "success").length;
    const failedCount = results.filter((item) => item.status === "failed").length;

    const savedHistory = await EmailHistory.create({
      message: message.trim(),
      totalRecipients: recipients.length,
      successful: successCount,
      failed: failedCount,
      results,
    });

    return res.status(200).json({
      message: "Email sending completed",
      total: recipients.length,
      successful: successCount,
      failed: failedCount,
      results,
      historyId: savedHistory._id,
    });
  } catch (error) {
    console.error("Server Error:", error.message);
    return res.status(500).json({ message: "Failed to send emails", error: error.message });
  }
});

// ================================
// Get Email History
// ================================
app.get("/history", async (req, res) => {
  try {
    const history = await EmailHistory.find().sort({ createdAt: -1 });
    return res.status(200).json({ total: history.length, history });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch email history", error: error.message });
  }
});

app.get("/", (req, res) => {
  res.json({ message: "BulkMailer Backend is running successfully" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));