export const EXAMPLES = [
  {
    label: "Redact emails",
    instruction:
      "Find email addresses in the Email column and replace them with 'REDACTED'.",
  },
  {
    label: "Remove email addresses",
    instruction: "Remove email addresses from the Email column.",
  },
  {
    label: "Mask digits",
    instruction: "Replace each digit in the ID column with 'X'.",
  },
];
export const SAMPLE =
  "ID,Name,Email,Department,Status\n001,John Doe,john.doe@example.com,Operations,Active\n002,Jane Smith,jane@domain.com; jane.work@example.org,Finance,Active\n003,Alice Brown,,Product,Pending\n004,Marcus Chen,marcus.chen@example.com,Engineering,Active\n005,Olivia Wilson,olivia.w@example.com,Operations,Pending\n006,Noah Williams,noah@example.org,Design,Active\n007,Emma Davis,,Finance,Pending\n008,Liam Anderson,liam.a@example.com,Engineering,Active\n009,Sophia Taylor,sophia@example.org,Product,Active\n010,James Thomas,,Operations,Pending\n011,Isabella Moore,isabella@example.com,Design,Active\n012,Lucas Martin,lucas@example.org,Finance,Active";
