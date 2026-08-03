import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const mailerConfig = {
  host: process.env["SMTP_HOST"],
  port: process.env["SMTP_PORT"] ? Number.parseInt(process.env["SMTP_PORT"], 10) : undefined,
  secure: process.env["SMTP_SECURE"] === "true",
  user: process.env["SMTP_USER"],
  pass: process.env["SMTP_PASS"],
  from: process.env["SMTP_FROM"],
};

const isMailerConfigured = () =>
  Boolean(
    mailerConfig.host &&
      mailerConfig.port &&
      mailerConfig.user &&
      mailerConfig.pass &&
      mailerConfig.from,
  );

let transporterPromise: Promise<nodemailer.Transporter | null> | null = null;

const getTransporter = async () => {
  if (!isMailerConfigured()) {
    return null;
  }

  transporterPromise ??= Promise.resolve(
    nodemailer.createTransport({
      host: mailerConfig.host,
      port: mailerConfig.port,
      secure: mailerConfig.secure,
      auth: {
        user: mailerConfig.user,
        pass: mailerConfig.pass,
      },
    }),
  );

  return transporterPromise;
};

export const sendPasswordResetOtpEmail = async (email: string, otpCode: string) => {
  const transporter = await getTransporter();

  if (!transporter) {
    return false;
  }

  await transporter.sendMail({
    from: mailerConfig.from,
    to: email,
    subject: "Mã OTP đặt lại mật khẩu",
    text: `Mã OTP đặt lại mật khẩu của bạn là ${otpCode}. Mã có hiệu lực trong 10 phút.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <h2 style="margin-bottom: 12px;">Mã OTP đặt lại mật khẩu</h2>
        <p>Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản của mình.</p>
        <p>Mã OTP 6 số của bạn là:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${otpCode}</p>
        <p>Mã sẽ hết hạn sau 10 phút.</p>
        <p>Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email.</p>
      </div>
    `,
  });

  return true;
};

export const isPasswordResetMailerConfigured = isMailerConfigured;
