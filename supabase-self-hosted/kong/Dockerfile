FROM kong:2.8.1

USER root

RUN mkdir -p /var/lib/kong && chown -R kong:kong /var/lib/kong
COPY --chown=kong:kong kong.yml /var/lib/kong/kong.yml
COPY --chown=kong:kong docker-entrypoint.sh /docker-entrypoint-custom.sh
RUN chmod 755 /docker-entrypoint-custom.sh

USER kong

ENTRYPOINT ["/docker-entrypoint-custom.sh"]
