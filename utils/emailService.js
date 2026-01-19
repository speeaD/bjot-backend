// Create this file: utils/emailService.js

const nodemailer = require('nodemailer');

// Configure your email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail', // or your email service
  auth: {
    user: process.env.EMAIL_USER, // Your email
    pass: process.env.EMAIL_PASSWORD, // Your email password or app password
  },
});

// Alternative configuration for other services:
/*
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});
*/

/**
 * Send access code email to premium students
 * @param {string} email - Recipient email
 * @param {string} name - Recipient name
 * @param {string} accessCode - Generated access code
 */
const sendAccessCodeEmail = async (email, name, accessCode) => {
  try {
    const mailOptions = {
      from: `"Quiz Platform" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your Quiz Platform Access Code',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #4CAF50;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 5px 5px 0 0;
            }
            .content {
              background-color: #f9f9f9;
              padding: 30px;
              border: 1px solid #ddd;
              border-top: none;
            }
            .access-code {
              background-color: #fff;
              border: 2px dashed #4CAF50;
              padding: 20px;
              text-align: center;
              font-size: 24px;
              font-weight: bold;
              letter-spacing: 3px;
              margin: 20px 0;
              color: #4CAF50;
            }
            .footer {
              text-align: center;
              margin-top: 20px;
              padding-top: 20px;
              border-top: 1px solid #ddd;
              color: #777;
              font-size: 12px;
            }
            .button {
              display: inline-block;
              padding: 12px 30px;
              background-color: #4CAF50;
              color: white;
              text-decoration: none;
              border-radius: 5px;
              margin-top: 20px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to Quiz Platform!</h1>
            </div>
            <div class="content">
              <p>Hello ${name || 'Student'},</p>
              
              <p>Your premium account has been successfully created. You can now access all assigned quizzes using your unique access code.</p>
              
              <div class="access-code">
                ${accessCode}
              </div>
              
              <p><strong>How to use your access code:</strong></p>
              <ol>
                <li>Visit the quiz platform login page</li>
                <li>Enter your email address: <strong>${email}</strong></li>
                <li>Enter your access code shown above</li>
                <li>Start taking your assigned quizzes!</li>
              </ol>
              
              <p><strong>Important:</strong></p>
              <ul>
                <li>Keep this access code secure and do not share it with others</li>
                <li>You can use this code to login anytime</li>
                <li>If you forget your code, contact your administrator</li>
              </ul>
              
              <div style="text-align: center;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" class="button">
                  Go to Quiz Platform
                </a>
              </div>
            </div>
            <div class="footer">
              <p>This is an automated email. Please do not reply to this message.</p>
              <p>&copy; ${new Date().getFullYear()} Quiz Platform. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
Hello ${name || 'Student'},

Your premium account has been successfully created!

Your Access Code: ${accessCode}

How to login:
1. Visit the quiz platform
2. Enter your email: ${email}
3. Enter your access code: ${accessCode}

Keep this code secure and do not share it with others.

Visit: ${process.env.FRONTEND_URL || 'http://localhost:3000'}

Best regards,
Quiz Platform Team
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${email}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`Error sending email to ${email}:`, error);
    throw error;
  }
};

/**
 * Send bulk welcome email (optional - for notifications)
 * @param {Array} recipients - Array of {email, name, accessCode}
 */
const sendBulkWelcomeEmails = async (recipients) => {
  const results = {
    successful: [],
    failed: [],
  };

  for (const recipient of recipients) {
    try {
      await sendAccessCodeEmail(recipient.email, recipient.name, recipient.accessCode);
      results.successful.push(recipient.email);
    } catch (error) {
      results.failed.push({
        email: recipient.email,
        error: error.message,
      });
    }
  }

  return results;
};

// Verify email configuration on startup
const verifyEmailConfig = async () => {
  try {
    await transporter.verify();
    console.log('✅ Email service is ready');
  } catch (error) {
    console.error('❌ Email service configuration error:', error);
  }
};

module.exports = {
  sendAccessCodeEmail,
  sendBulkWelcomeEmails,
  verifyEmailConfig,
  transporter,
};