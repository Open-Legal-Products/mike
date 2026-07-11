#syntax=docker/dockerfile:1

FROM node:20.19.0-slim

WORKDIR /app

RUN groupadd -r mike && useradd -r -g mike -d /app -s /sbin/nologin mike \
  && chown -R mike:mike /app

USER mike

EXPOSE 3000

CMD ["npm", "run", "dev"]
