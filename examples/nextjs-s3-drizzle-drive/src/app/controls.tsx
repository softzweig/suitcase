"use client";

import { useUploadResource } from "@softzweig/suitcase-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import type { DriveClient } from "@/suitcase/definition";
import { setCurrentUser } from "@/user";

/** Who the drive acts as, and the one control that puts a file into it. */
export function Controls({ user }: Readonly<{ user: string }>) {
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user);
  const { error, phase, upload } = useUploadResource<DriveClient>();

  async function send(file: File) {
    const result = await upload({ file, kind: "file" });

    if (picker.current) picker.current.value = "";
    // The list is a server render of this user's files, so a finished upload asks for it again.
    if (result) router.refresh();
  }

  function switchUser(event: FormEvent) {
    event.preventDefault();
    setCurrentUser(name);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form className="flex items-center gap-2" onSubmit={switchUser}>
        <label className="flex items-center gap-2 text-sm text-neutral-500">
          acting as
          <input
            className="w-32 rounded-lg border border-neutral-200 bg-white/70 px-3 py-1.5 text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-900/10 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-100 dark:focus:border-neutral-600 dark:focus:ring-white/10"
            onChange={(event) => setName(event.target.value)}
            placeholder="ada"
            value={name}
          />
        </label>
        <button
          className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
          type="submit"
        >
          Switch
        </button>
      </form>

      <label className="cursor-pointer rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90 has-disabled:opacity-50 dark:bg-white dark:text-neutral-900">
        {phase === "uploading" ? "Uploading…" : "Add file"}
        <input
          className="sr-only"
          disabled={phase === "uploading"}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void send(file);
          }}
          ref={picker}
          type="file"
        />
      </label>

      {error ? (
        <span className="text-sm text-red-600 dark:text-red-400">{error.message}</span>
      ) : null}
    </div>
  );
}
