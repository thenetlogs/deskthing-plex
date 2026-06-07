import { DeskThing } from "@deskthing/server";
import type { SongData } from "@deskthing/types";
import { EMPTY_SONG } from "./sessionMapper";

let current: SongData = EMPTY_SONG;

export const setSong = (song: SongData) => {
  current = song;
  DeskThing.sendSong(current);
};

export const clearSong = () => setSong(EMPTY_SONG);

export const resendSong = () => DeskThing.sendSong(current);
