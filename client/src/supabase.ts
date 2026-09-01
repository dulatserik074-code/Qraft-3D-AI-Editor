import { createClient, type Session } from "@supabase/supabase-js";
import { projectV2Schema, type ProjectV2 } from "./model";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const supabaseConfigured = Boolean(url && anonKey);
export const supabase = supabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
export const getSession = async (): Promise<Session | null> =>
  (await supabase?.auth.getSession())?.data.session ?? null;
export const signUp = async (email: string, password: string) => {
  if (!supabase) throw new Error("Supabase не настроен.");
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
};
export const signIn = async (email: string, password: string) => {
  if (!supabase) throw new Error("Supabase не настроен.");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
};
export const signOut = () => supabase?.auth.signOut();
export const resetPassword = async (email: string) => {
  if (!supabase) throw new Error("Supabase не настроен.");
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw error;
};
export async function listCloudProjects(): Promise<ProjectV2[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) =>
    projectV2Schema.parse({
      version: 2,
      id: row.id,
      name: row.name,
      objects: row.scene_json,
      thumbnail: row.thumbnail_path,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      syncStatus: "synced",
    }),
  );
}
export async function saveCloudProject(
  project: ProjectV2,
  userId: string,
): Promise<ProjectV2> {
  if (!supabase) throw new Error("Supabase не настроен.");
  const { data: existing } = await supabase
    .from("projects")
    .select("revision")
    .eq("id", project.id)
    .maybeSingle();
  if (existing && existing.revision !== project.revision)
    throw new Error("CLOUD_CONFLICT");
  const nextRevision = project.revision + 1;
  const payload = {
    id: project.id,
    user_id: userId,
    name: project.name,
    scene_json: project.objects,
    thumbnail_path: project.thumbnail,
    revision: nextRevision,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("projects")
    .upsert(payload)
    .select()
    .single();
  if (error) throw error;
  return projectV2Schema.parse({
    ...project,
    revision: data.revision,
    updatedAt: data.updated_at,
    syncStatus: "synced",
  });
}
