// A generated answer failed the coverage gate after its factual repairs.
// Nothing from that answer has been committed; uploads may draft it again.
export class IncompleteSectionEvidence extends Error {
  constructor() {
    super("The section draft omits required evidence after checking; no incomplete draft was saved. Retry the section update.");
    this.name = "IncompleteSectionEvidence";
  }
}
