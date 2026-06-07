export const APP_ID = "plex";

export interface PlexPlayer {
  state?: string;            // "playing" | "paused" | "buffering"
  title?: string;
  product?: string;
  machineIdentifier?: string;
}
export interface PlexUser { title?: string }

export interface PlexMetadata {
  type?: string;             // "track" for music
  ratingKey?: string;
  title?: string;            // track name
  grandparentTitle?: string; // artist
  parentTitle?: string;      // album
  duration?: number;         // ms
  viewOffset?: number;       // ms (current position)
  thumb?: string;
  parentThumb?: string;
  grandparentThumb?: string;
  Player?: PlexPlayer;
  User?: PlexUser;
}
export interface PlexSessionsResponse {
  MediaContainer?: { size?: number; Metadata?: PlexMetadata[] };
}
