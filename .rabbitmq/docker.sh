#!/bin/bash

for i in {1..6}
do
  project_name="fed0$i"
  docker compose -p "$project_name" --env-file="$project_name.env" up -d
done
