#!/bin/bash

for i in {1..7}
do
  project_name="fed0$i"
  docker compose -p "$project_name" --env-file="$project_name.env" down
done
