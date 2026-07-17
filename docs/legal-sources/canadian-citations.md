# Canadian citation engine

Status: implemented foundation for Delivery A (ROSS-090)
Last source review: 2026-07-16

ROSS parses and normalizes the following initial citation families:

- Canadian neutral case citations, including SCC, federal, and Ontario courts;
- CanLII citations with the deciding court or tribunal identifier;
- common S.C.R., O.R., and D.L.R. reporter forms;
- Ontario and federal revised and annual statute citations;
- Ontario regulations, R.R.O. regulations, SOR, and DORS instruments;
- paragraph, page, section, and rule pinpoints and ranges;
- common English and French Ontario regulation forms.

## Verification boundary

Parsing proves only that text matches a supported citation grammar. Every
parsed citation begins as `unverified`. ROSS separately tracks:

- citation verification;
- passage verification;
- legislation currency verification; and
- subsequent-treatment verification.

A state is upgraded only after an authorized provider returns a matching
source. A case citation can be checked through A2AJ or a future licensed
provider. A statute or regulation can be checked against the matching official
e-Laws or Justice Laws provider. A citation match does not automatically verify
the quoted passage, currency, or treatment.

## Rendering

The Ontario profile follows the Court of Appeal for Ontario guide: prefer a
neutral citation, use `at para.` or `at paras.` for numbered decisions, and use
section/rule pinpoints for legislation. The `mcgill-compatible` profile is an
explicit compatibility target and currently emits the same supported primary
law forms. Case-name italics remain a presentation-layer responsibility so the
same structured citation can be rendered in HTML, Markdown, DOCX, or plain
text without embedding markup in its canonical value.

## Primary references

- [Court of Appeal for Ontario citation guide](https://www.ontariocourts.ca/coa/how-to-proceed-court/practice-directions-guidelines/reference-guide-citation/)
- [Ontario Superior Court civil practice direction](https://www.ontariocourts.ca/scj/areas-of-law/civil-court/civil-pd/)
- [CanLII RefLex citation explanation](https://www.canlii.org/info/reflex.html)

## Limitations

This foundation does not attempt to parse every historical reporter, loose-leaf
service, secondary source, docket number, or local court variation. Unsupported
or malformed text remains unparsed and therefore unverified. Additional
patterns require positive, negative, bilingual, and collision tests before
activation.
