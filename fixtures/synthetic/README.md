# Synthetic Fixtures

These files are generated for local development and testing only. They contain no real client data, no privileged information, and no executable content.

Files:
- sample.pdf — minimal valid PDF
- sample.docx — minimal valid DOCX
- sample.xlsx — minimal valid XLSX
- nda.docx — synthetic NDA text
- contract.docx — synthetic service agreement
- invalid.pdf — text file with PDF extension for negative tests

To generate an oversized test file on demand:
  dd if=/dev/zero of=oversized.bin bs=1M count=105
