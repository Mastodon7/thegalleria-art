FROM node:20-alpine
WORKDIR /app
COPY server.js ./
COPY public ./public
ENV PORT=80
EXPOSE 80
CMD ["node", "server.js"]
