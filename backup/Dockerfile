# Same major version as the database, so pg_dump and pg_restore always match the server.
FROM postgres:18-alpine
RUN apk add --no-cache restic
COPY *.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh
ENTRYPOINT ["/usr/local/bin/loop.sh"]
