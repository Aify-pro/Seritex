FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY sync.js ./
# Le mode (15min ou nuit) se passe en argument : docker run ... sage-nas-sync nuit
ENTRYPOINT ["node", "sync.js"]
CMD ["15min"]
