export type Reference = { id: string; title: string; href: string; kind: "Knowledge" | "Article" | "Source"; text: string };
export type Message = { role: "user" | "assistant"; content: string; references?: Reference[] };
