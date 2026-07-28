import { supabase } from "./supabase";
import { stripImageMetadata } from "./images";

export async function uploadPlacePhoto(ownerId: string, placeId: string, file: File): Promise<string> {
  // Owner uploads go to a public bucket too — same stripping applies.
  const clean = await stripImageMetadata(file);
  const path = `${ownerId}/${placeId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from("place-photos").upload(path, clean, {
    contentType: "image/jpeg",
  });
  if (error) throw error;
  const { data } = supabase.storage.from("place-photos").getPublicUrl(path);
  return data.publicUrl;
}
