import bcrypt from 'bcryptjs'
import { generateSecret, verifySync, generateURI } from 'otplib'
import QRCode from 'qrcode'

export const hashPassword  = (p: string)              => bcrypt.hash(p, 12)
export const verifyPassword = (p: string, hash: string) => bcrypt.compare(p, hash)

export function generateTotpSecret() {
  return generateSecret()
}

export function verifyTotp(token: string, secret: string): boolean {
  return verifySync({ token, secret }).valid
}

export async function generateTotpQR(username: string, secret: string): Promise<string> {
  const otpauth = generateURI({ label: username, issuer: process.env.TOTP_ISSUER ?? 'RewardHub', secret })
  return QRCode.toDataURL(otpauth)
}
