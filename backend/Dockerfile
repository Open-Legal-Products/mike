#syntax=docker/dockerfile:1

FROM node:20.19.0-slim

# Install LibreOffice for DOC/DOCX/PPTX to PDF conversion.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     libreoffice-writer \
     libreoffice-calc \
     libreoffice-impress \
     fonts-dejavu \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Run as non-root.
RUN groupadd -r mike && useradd -r -g mike -d /app -s /sbin/nologin mike \
  && chown -R mike:mike /app

USER mike

EXPOSE 3001

CMD ["npm", "run", "dev"]
