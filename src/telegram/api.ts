import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram/tl/index.js';

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const session = new StringSession(process.env.TG_SESSION || '');

if (!apiId || !apiHash) {
  throw new Error('Missing TG_API_ID or TG_API_HASH in environment.');
}

export const client = new TelegramClient(session, apiId, apiHash, {
  connectionRetries: 5,
});

let connected = false;
export async function ensureConnected() {
  if (!connected) {
    await client.connect();
    connected = true;
  }
}

export async function call(method, params) {
  await ensureConnected();
  switch (method) {
    case 'auth.sendCode': {
      const { phone_number, settings } = params;
      if (!phone_number) throw new Error('phone_number is required');
      const codeSettings = settings?.['_'] === 'codeSettings'
        ? new Api.CodeSettings({})
        : new Api.CodeSettings({});
      const res:any = await client.invoke(new Api.auth.SendCode({
        phoneNumber: phone_number,
        apiId,
        apiHash,
        settings: codeSettings,
      }));
      // Normalize to match your expected shape
      return {
        phone_code_hash: res.phoneCodeHash,
        is_password: false,
        type: res.type?.className || null
      };
    }
    case 'auth.signIn': {
      const { phone_number, phone_code, phone_code_hash } = params;
      if (!phone_number || !phone_code || !phone_code_hash) {
        throw new Error('phone_number, phone_code and phone_code_hash are required');
      }
      const res:any = await client.invoke(new Api.auth.SignIn({
        phoneNumber: phone_number,
        phoneCodeHash: phone_code_hash,
        phoneCode: phone_code,
      }));
      return res; // raw TLObject back
    }
    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

export function getSessionString(): string {
  (client.session as any).save();
  return (client.session as any).save();
}
