/**
 * The narrow slice of DiscordApi the News Worker actually needs: reading
 * recent messages for dedup, knowing its own user id, and posting. Keeping
 * this separate from the full DiscordApi means a minimal offline stand-in
 * (offline_api.ts) doesn't have to implement the whole surface.
 */

import type { DiscordApi } from "../discord/endpoints.js";

export interface NewsDiscordApi {
  getCurrentUser: DiscordApi["getCurrentUser"];
  listMessages: DiscordApi["listMessages"];
  createMessage: DiscordApi["createMessage"];
}
