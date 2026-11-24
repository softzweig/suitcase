import type { IconType } from "react-icons";
import { FiArchive, FiFileText, FiFilm, FiMusic } from "react-icons/fi";

/** A glyph per family of file: images never get here, they are their own thumbnail. */
const ICONS = {
  archive: FiArchive,
  audio: FiMusic,
  document: FiFileText,
  video: FiFilm,
} as const satisfies Record<string, IconType>;

type Glyph = keyof typeof ICONS;

const glyphFor = (mimeType: string): Glyph => {
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (/zip|tar|rar|7z|compressed|gzip/.test(mimeType)) return "archive";

  return "document";
};

export function FileIcon({ mimeType }: Readonly<{ mimeType: string }>) {
  const Icon = ICONS[glyphFor(mimeType)];

  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500">
      <Icon aria-hidden="true" className="size-5" />
    </span>
  );
}
