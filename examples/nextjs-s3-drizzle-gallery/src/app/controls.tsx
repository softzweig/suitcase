"use client";

import { useUploadResource } from "@softzweig/suitcase-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { currentUser, setCurrentUser } from "@/session";
import type { GalleryClient } from "@/suitcase/definition";

/** Who the next call acts as, and the one control that adds a photo to the wall. */
export function Controls() {
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [user, setUser] = useState(currentUser);
  const { error, phase, upload } = useUploadResource<GalleryClient>();

  async function send(file: File) {
    const result = await upload({ file, kind: "photo" });

    if (picker.current) picker.current.value = "";
    // The wall is a server render of the newest photos, so a finished upload asks for it again.
    if (result) router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2 text-sm text-neutral-500">
        acting as
        <input
          className="w-36 rounded-lg border border-neutral-200 bg-white/70 px-3 py-1.5 text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-900/10 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-100 dark:focus:border-neutral-600 dark:focus:ring-white/10"
          onChange={(event) => {
            setUser(event.target.value);
            setCurrentUser(event.target.value);
          }}
          placeholder="demo-user"
          value={user}
        />
      </label>

      <input
        ref={picker}
        accept="image/*"
        className="text-sm text-neutral-500 file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-neutral-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white file:shadow-sm file:transition hover:file:opacity-90 disabled:opacity-50 dark:file:bg-white dark:file:text-neutral-900"
        disabled={phase === "uploading"}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void send(file);
        }}
        type="file"
      />

      {phase === "uploading" ? <span className="text-sm text-neutral-500">Uploading…</span> : null}
      {error ? (
        <span className="text-sm text-red-600 dark:text-red-400">{error.message}</span>
      ) : null}
    </div>
  );
}
