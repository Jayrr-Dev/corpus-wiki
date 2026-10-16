export type Reference = { id: string; title: string; href: string; kind: "Knowledge" | "Article" | "Source" | "Glossary"; text: string };
export type AgentActivity = { id: string; label: string; status: "completed" | "failed" | "confirmation"; detail: string; href?: string; decision?: { name: "resolve_exception"; exceptionId: string; accept: boolean; note: string } };
export type Message = { role: "user" | "assistant"; content: string; references?: Reference[]; activities?: AgentActivity[] };
