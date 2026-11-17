import {json} from "../../server/http.js";

// The signed-in person. The owner can see the access settings.
export async function onRequestGet({data}) {
  const {email, name, role, telegram_chat_id: telegramChatId} = data.user;
  return json({email, name, role, telegramLinked: !!telegramChatId});
}
