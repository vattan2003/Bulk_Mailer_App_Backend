require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();


// ================================
// Middleware
// ================================
app.use(cors());
app.use(express.json());


// ================================
// MongoDB Connection
// ================================
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB Connected");
    console.log(process.env.MONGODB_URI);
    
  })
  .catch((error) => {
    console.error(
      "MongoDB Connection Error:",
      error.message
    );
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
        email: {
          type: String,
        },

        status: {
          type: String,
        },

        accepted: [
          {
            type: String,
          },
        ],

        rejected: [
          {
            type: String,
          },
        ],

        error: {
          type: String,
        },

        messageId: {
          type: String,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);


// ================================
// History Model
// ================================
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
// Test SMTP Connection
// ================================
transporter.verify((error) => {
  if (error) {
    console.error(
      "SMTP Connection Error:",
      error.message
    );
  } else {
    console.log("Gmail SMTP Server is ready");
  }
});


// ================================
// Send Bulk Emails
// ================================
app.post("/sendMail", async (req, res) => {
  try {
    const { message, recipients } = req.body;

    console.log("\n========== NEW CAMPAIGN ==========");

    // Validate message
    if (!message || !message.trim()) {
      return res.status(400).json({
        message: "Email message is required",
      });
    }

    // Validate recipients
    if (
      !Array.isArray(recipients) ||
      recipients.length === 0
    ) {
      return res.status(400).json({
        message: "No recipients provided",
      });
    }

    console.log("Total recipients:", recipients.length);

    const results = [];


    // Send to every recipient
    for (let i = 0; i < recipients.length; i++) {
      const email = String(recipients[i]).trim();

      console.log(
        `[${i + 1}/${recipients.length}] Sending to: ${email}`
      );

      // Skip empty email
      if (!email) {
        results.push({
          email,
          status: "failed",
          error: "Empty email address",
        });

        continue;
      }

      try {
        const info = await transporter.sendMail({
          from: {
            name: "BulkMailer",
            address: process.env.EMAIL_USER,
          },

          to: email,

          subject: "BulkMailer Campaign",

          text: message,

          html: `
            <div style="
              font-family: Arial, sans-serif;
              max-width: 600px;
              margin: auto;
              padding: 20px;
            ">
              <h2>BulkMailer</h2>

              <p>${message}</p>

              <hr />

              <small>
                Sent using BulkMailer Email Campaign Platform
              </small>
            </div>
          `,
        });

        console.log(
          `[${i + 1}/${recipients.length}] SUCCESS`
        );

        console.log("Message ID:", info.messageId);
        console.log("Accepted:", info.accepted);
        console.log("Rejected:", info.rejected);


        // Store success result
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


        // Store failed result
        results.push({
          email,
          status: "failed",
          error: error.message,
        });
      }
    }


    // ================================
    // Calculate Final Results
    // ================================
    const successCount = results.filter(
      (item) => item.status === "success"
    ).length;

    const failedCount = results.filter(
      (item) => item.status === "failed"
    ).length;


    console.log("\n========== FINAL RESULTS ==========");

    console.log(
      `Total: ${recipients.length}`
    );

    console.log(
      `Successful: ${successCount}`
    );

    console.log(
      `Failed: ${failedCount}`
    );


    // ================================
    // Save History to MongoDB
    // ================================
    const savedHistory = await EmailHistory.create({
      message: message.trim(),
      totalRecipients: recipients.length,
      successful: successCount,
      failed: failedCount,
      results,
    });


    console.log(
      "Campaign history saved successfully:",
      savedHistory._id
    );


    // ================================
    // Send Final Response
    // ================================
    return res.status(200).json({
      message: "Email sending completed",

      total: recipients.length,

      successful: successCount,

      failed: failedCount,

      results,

      historyId: savedHistory._id,
    });

  } catch (error) {
    console.error(
      "Server Error:",
      error.message
    );

    return res.status(500).json({
      message: "Failed to send emails",
      error: error.message,
    });
  }
});


// ================================
// Get Email History
// ================================
app.get("/history", async (req, res) => {
  try {
    const history = await EmailHistory
      .find()
      .sort({ createdAt: -1 });


    return res.status(200).json({
      total: history.length,
      history,
    });

  } catch (error) {
    console.error(
      "History Error:",
      error.message
    );

    return res.status(500).json({
      message: "Failed to fetch email history",
      error: error.message,
    });
  }
});


// ================================
// Health Check Route
// ================================
app.get("/", (req, res) => {
  res.json({
    message: "BulkMailer Backend is running successfully",
  });
});


// ================================
// Start Server
// ================================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `Server is running on port ${PORT}`
  );
});