FROM node:20-alpine
WORKDIR /app
COPY server.js ./
COPY seed-content.json ./
COPY public ./public
ENV PORT=80
ENV DATA_DIR=/data
EXPOSE 80
CMD ["node", "server.js"]
