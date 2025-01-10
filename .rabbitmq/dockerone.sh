#!/bin/bash
read -p "What is the federator number? " fed 
project_name="fed0$fed"

echo "What do you want to do with it? " 
select action in "Deploy" "Remove"; do
  case $action in
    Deploy ) docker compose -p "$project_name" --env-file="$project_name.env" up -d; exit;;
    Remove ) docker compose -p "$project_name" --env-file="$project_name.env" down; exit;;
  esac
done
