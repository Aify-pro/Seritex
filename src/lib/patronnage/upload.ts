const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo — un DXF est un fichier texte, largement suffisant

export function readDxfFile(formData: FormData, field = "file"): { text: string; file: File } | { error: string } {
  const file = formData.get(field);
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Merci de sélectionner un fichier DXF" };
  }
  if (file.size > MAX_SIZE_BYTES) {
    return { error: "Fichier trop volumineux (10 Mo maximum)" };
  }
  return { file, text: "" };
}
