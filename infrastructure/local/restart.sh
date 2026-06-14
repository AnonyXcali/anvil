#right now we are deleting the volumes, ideally should not happen!
docker compose down -v && docker compose build --no-cache api && docker compose up
