/**
 * Zero-config stand-in used only when there is no Discord bot token (or
 * --offline is passed): lets `npm run news:dry` exercise the whole pipeline
 * with the Mock Provider and no credentials at all. createMessage throws
 * unconditionally -- cli.ts only reaches it if dry-run were somehow off,
 * which it refuses to allow while running offline.
 */

import type { APIMessage, APIUser } from "../discord/types.js";
import type { NewsDiscordApi } from "./discord_api.js";

export function createOfflineNewsApi(): NewsDiscordApi {
  const botUser: APIUser = {
    id: "0",
    username: "offline-bullhaus-news-worker",
    discriminator: "0",
    bot: true,
  };

  return {
    async getCurrentUser(): Promise<APIUser> {
      return botUser;
    },
    async listMessages(): Promise<APIMessage[]> {
      // No real channel history is available offline; treat as empty rather
      // than guessing. This can only ever suppress "already published"
      // matches, never cause a false duplicate.
      return [];
    },
    async createMessage(): Promise<APIMessage> {
      throw new Error(
        "Offline mode never sends real Discord messages. This is unreachable " +
          "while dry-run is enforced for offline runs.",
      );
    },
  };
}
