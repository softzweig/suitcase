import { handleOperation } from "@/suitcase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every Suitcase operation, `POST /api/suitcase/uploads.initialize` and the rest. */
export const POST = handleOperation;
