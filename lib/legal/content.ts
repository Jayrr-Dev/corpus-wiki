// =====================================================================
// LEGAL PAGE TEXT: the draft privacy policy and terms, kept as data so the
// pages stay layout only and a test can check the wording. Every statement
// here describes what the app does today:
// - the database, sign-in and file storage run on Supabase
// - originals sit in a private bucket ('sources'), opened through signed links
// - AI work goes to Nebius Token Factory by default, to Anthropic when a
//   Claude model is picked, and to OpenRouter, Cerebras or Tavily only when
//   the workspace turns them on
// - uploaded files are kept as evidence for the claims built from them
// - there is no self-serve account deletion yet: it happens on request
// Change this file when any of those change.
// =====================================================================

export type LegalSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  items?: string[];
  // The page adds the contact address after this section's text
  contact?: boolean;
};

export type LegalDocument = {
  title: string;
  summary: string;
  sections: LegalSection[];
};

export const DRAFT_NOTICE = "Draft, not legal advice: review before launch";

// FAQ "Where is my data stored?": the short form of the storage and AI sections below
export const DATA_STORAGE_ANSWER =
  "Your account, the claims and pages built from your files, and the original files themselves are stored with Supabase. Originals sit in private storage and are kept as evidence for the claims that cite them. To read your files and write claims, text is sent to Nebius Token Factory, or to Anthropic when you pick a Claude model. You can ask us to delete your account and everything in it at any time.";

export const PRIVACY: LegalDocument = {
  title: "Privacy policy",
  summary: "What Corpus Wiki stores, where it goes, and how to have it removed.",
  sections: [
    {
      id: "collect",
      title: "What we collect",
      items: [
        "Your account: your email address and the sign-in details needed to keep you signed in.",
        "What you add: uploaded files, pasted text, notes, chat messages and anything your connected AI agents write.",
        "What we build from it: claims, pages, glossary and dictionary entries, stakeholder maps, links between them, and the search data used to find matching facts.",
        "Records of changes: what changed, when, who or what made the change, and which document caused it.",
        "Error reports: technical details when something fails, so we can fix it.",
      ],
    },
    {
      id: "storage",
      title: "Where it is stored",
      paragraphs: [
        "Corpus Wiki runs on Supabase. Your account, your content and everything built from it are stored in a Supabase database, and sign-in is handled by Supabase Auth.",
        "Uploaded files go to private Supabase storage. They are not public: the app opens them through short-lived signed links, only for people with access to the space.",
      ],
    },
    {
      id: "ai",
      title: "AI processing",
      paragraphs: [
        "To read your files and turn them into claims and pages, the text of your documents, and images where needed, is sent to AI model providers. Each provider handles that data under its own terms.",
      ],
      items: [
        "Nebius Token Factory runs the default models, the search data that matches facts, and image reading.",
        "Anthropic receives text when a Claude model is chosen in Settings.",
        "OpenRouter and Cerebras receive text only when the workspace turns them on and picks one of their models.",
        "Tavily receives search queries only when web search is turned on for a workspace.",
      ],
    },
    {
      id: "evidence",
      title: "Files kept as evidence",
      paragraphs: [
        "Every claim links back to the file and page it came from, so the original files are kept for as long as claims cite them. They stay until you delete them or your account is deleted.",
        "Older versions of claims and pages are kept in the change history, so any change can be checked and undone.",
      ],
    },
    {
      id: "sharing",
      title: "Who can see it",
      items: [
        "Your spaces are private to your account unless you publish them.",
        "An unlisted space can be read by anyone with its link or embed. A public one is also listed in Explore.",
        "The providers named above process data to run the service.",
        "We do not sell your data or use it for advertising.",
      ],
    },
    {
      id: "cookies",
      title: "Cookies",
      paragraphs: [
        "We use cookies to keep you signed in and to remember a few choices, such as your open space, time zone and sidebar. There are no advertising or tracking cookies.",
      ],
    },
    {
      id: "choices",
      title: "Your choices",
      items: [
        "Delete files, pages and spaces in the app at any time.",
        "Ask us to delete your account. We remove your account, your spaces and the files stored for them.",
        "Ask us for a copy of your data, or to correct it.",
      ],
    },
    {
      id: "contact",
      title: "Contact",
      paragraphs: ["For privacy questions or a deletion request, write to us from the address you sign in with."],
      contact: true,
    },
  ],
};

export const TERMS: LegalDocument = {
  title: "Terms of service",
  summary: "The rules for using Corpus Wiki.",
  sections: [
    {
      id: "agreement",
      title: "Using Corpus Wiki",
      paragraphs: [
        "By creating an account or using Corpus Wiki, you agree to these terms and to the privacy policy. If you use it for an organization, you confirm you may accept them on its behalf.",
      ],
    },
    {
      id: "account",
      title: "Your account",
      paragraphs: [
        "Keep your sign-in details and API keys safe. You are responsible for what happens in your account, including actions taken by AI agents you connect to it.",
      ],
    },
    {
      id: "content",
      title: "Your content",
      paragraphs: [
        "You keep ownership of what you upload and what is built from it. You give us permission to store, process and display it, and to send it to the AI providers named in the privacy policy, only to run the service for you.",
        "Only upload material you have the right to use.",
      ],
    },
    {
      id: "ai-output",
      title: "AI output",
      paragraphs: [
        "Claims, pages and answers are written by AI models and can be wrong or incomplete. Each one links to its source so you can check it. Do not rely on them as legal, medical, financial or other professional advice.",
      ],
    },
    {
      id: "use",
      title: "Acceptable use",
      items: [
        "No unlawful, harmful or infringing content.",
        "No attempts to reach other people's spaces or data.",
        "No attacks on the service, and no use that overloads it.",
        "No reselling the service without our agreement.",
      ],
    },
    {
      id: "publishing",
      title: "Published spaces",
      paragraphs: [
        "When you publish a space, anyone with the link can read it, and a public space is also listed in Explore. You are responsible for what you publish, and you can make it private again at any time.",
      ],
    },
    {
      id: "service",
      title: "The service",
      paragraphs: [
        "Corpus Wiki is provided as is and is still changing. Features may be added, changed or removed, and the service may sometimes be unavailable.",
      ],
    },
    {
      id: "ending",
      title: "Ending your use",
      paragraphs: [
        "You can stop using Corpus Wiki at any time and ask us to delete your account. We may suspend or close an account that breaks these terms.",
      ],
    },
    {
      id: "liability",
      title: "Liability",
      paragraphs: [
        "To the extent the law allows, we are not liable for indirect or consequential losses, or for decisions made on AI output.",
      ],
    },
    {
      id: "changes",
      title: "Changes to these terms",
      paragraphs: ["When these terms change, we update this page. Continuing to use Corpus Wiki after a change means you accept it."],
    },
    {
      id: "contact",
      title: "Contact",
      paragraphs: ["Questions about these terms are welcome."],
      contact: true,
    },
  ],
};
