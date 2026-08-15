require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();

app.use(cors());
app.use(express.json());


// ================================
// MongoDB Connection
// ================================
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB Connected");
  })
  .catch((error) => {
    console.error("MongoDB Connection Error:", error.message);
  });


// ================================
// History Schema
// ================================
const historySchema = new mongoose.Schema(
  {
    message: {
      type: String,
      required: true,
    },

    totalRecipients: {
      type: Number,
      required: true,
    },

    successful: {
      type: Number,
      default: 0,
    },

    failed: {
      type: Number,
      default: 0,
    },

    results: [
      {
        email: String,
        status: String,
        error: String,
        messageId: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);


// Create History Model
const EmailHistory = mongoose.model(
  "EmailHistory",
  historySchema
);


// ================================
// Gmail Transporter
// ================================
const transporter = nodemailer.createTransport({
  service: "gmail",

  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});


// ================================
// Send Bulk Emails
// ================================
app.post("/sendMail", async (req, res) => {
  try {
    const { message, recipients } = req.body;

    console.log("\n========== NEW CAMPAIGN ==========");

    if (!message || !message.trim()) {
      return res.status(400).json({
        message: "Email message is required",
      });
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        message: "No recipients provided",
      });
    }

    console.log("Total recipients:", recipients.length);

    const results = [];

    for (let i = 0; i < recipients.length; i++) {
      const email = String(recipients[i]).trim();

      console.log(
        `[${i + 1}/${recipients.length}] Sending to: ${email}`
      );

      try {
        const info = await transporter.sendMail({
          from: {
            name: "BulkMailer",
            address: process.env.EMAIL_USER,
          },
          to: email,
          subject: "BulkMailer Test",
          text: message,
          html: `
            <h2>BulkMailer Test</h2>
            <p>${message}</p>
          `,
        });

        console.log(`[${i + 1}/${recipients.length}] SUCCESS`);
        console.log("Accepted:", info.accepted);
        console.log("Rejected:", info.rejected);

        results.push({
          email,
          status: "success",
          accepted: info.accepted,
          rejected: info.rejected,
          messageId: info.messageId,
        });

      } catch (error) {
        console.error(
          `[${i + 1}/${recipients.length}] FAILED:`,
          error.message
        );

        results.push({
          email,
          status: "failed",
          error: error.message,
        });
      }
    }

    console.log("========== FINAL RESULTS ==========");
    console.log(JSON.stringify(results, null, 2));

    const successCount = results.filter(
      (item) => item.status === "success"
    ).length;

    const failedCount = results.filter(
      (item) => item.status === "failed"
    ).length;

    return res.status(200).json({
      message: "Email sending completed",
      total: recipients.length,
      successful: successCount,
      failed: failedCount,
      results,
    });

  } catch (error) {
    console.error("Server Error:", error.message);

    return res.status(500).json({
      message: "Failed to send emails",
      error: error.message,
    });
  }
});


// ================================
// GET EMAIL HISTORY
// ================================
app.get("/history", async (req, res) => {
  try {
    const history = await EmailHistory
      .find()
      .sort({ createdAt: -1 });


    return res.status(200).json(history);


  } catch (error) {
    console.error("History Error:", error);

    return res.status(500).json({
      message: "Failed to fetch email history",
    });
  }
});


// ================================
// Start Server
// ================================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});