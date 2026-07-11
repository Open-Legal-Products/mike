# Synthetic Test Documents

All documents in this directory are synthetic and contain no real client data,
no personally identifiable information, and no privileged content.

## Watermark

Every document contains the visible text:

  SYNTHETIC TEST DOCUMENT — NO REAL CLIENT DATA

## Files

- sample-contract.pdf — simple PDF generated with ReportLab
- sample-contract.docx — DOCX generated with python-docx
- sample-spreadsheet.xlsx — XLSX generated with openpyxl
- sample-nda.pdf — another synthetic PDF
- empty.pdf — zero-content PDF page
- invalid-extension.txt — text file used to test MIME/extension validation
- corrupted.pdf — truncated PDF used to test error handling
- near-limit.pdf — large-ish PDF close to the allowed upload limit

## Generation

Run `python3 generate-fixtures.py` to recreate all files.
