# Rubric — Companies House due-diligence snapshot

Score each dimension 1–5; the overall score may not exceed `no_invented_facts`.

## issue_spotting_completeness
The snapshot must cover: company identity (name, number, status, type, incorporation
date, registered office), current officers with appointment dates, persons with
significant control and the nature of their control, latest accounts and confirmation
statement (filed and next-due dates), and red flags (overdue filings, insolvency or
strike-off markers, recently resigned officers, dissolved status). 5 = all present and
correctly prioritised; deduct for each omitted category.

## correct_law
Statements about filing obligations, PSC regimes, or company status must be accurate
under the Companies Act 2006 and related legislation. Any statutory reference must be
precise (e.g. `s.790C Companies Act 2006` for PSCs). Wrong or vague law caps this at 2.

## uk_terminology
UK English and UK legal/company terminology throughout (company/Ltd/plc/LLP, not
corporation/Inc.; postcode; DD/MM/YYYY dates; "filed at Companies House"). Any US
terminology from the CLAUDE.md table caps this at 3.

## no_invented_facts
Every factual claim must be traceable to the retrieved Companies House data supplied
with the output. Any officer, date, filing, or company detail not present in the
source data is an invented fact: score 1 and list each in `failures`.
