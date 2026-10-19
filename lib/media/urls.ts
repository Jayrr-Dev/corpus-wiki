export function originalMediaUrl(src: string) {
  return /^\/api\/(assets|sources|composer)\//.test(src) && !/[?&](?:original|download)=/.test(src)
    ? `${src}${src.includes("?") ? "&" : "?"}original=1` : src;
}
