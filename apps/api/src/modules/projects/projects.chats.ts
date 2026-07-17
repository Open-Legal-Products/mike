// Project chats: list the chats that belong to a project.
//
// Service layer behind projects.routes.ts — see projects.shared.ts for the
// module's contract.

import { checkProjectAccess } from "../../lib/access";
import { type Db, attachChatCreatorLabels } from "./projects.shared";

export async function listProjectChats(
  db: Db,
  params: { projectId: string; userId: string; userEmail: string | undefined },
): Promise<
  | { ok: true; chats: unknown[] }
  | { ok: false; kind: "forbidden" }
  | { ok: false; kind: "db_error"; detail: string }
> {
  const { projectId, userId, userEmail } = params;
  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return { ok: false, kind: "forbidden" };

  const { data, error } = await db
    .from("chats")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, kind: "db_error", detail: error.message };
  const chats = data ?? [];
  await attachChatCreatorLabels(db, chats);
  return { ok: true, chats };
}
