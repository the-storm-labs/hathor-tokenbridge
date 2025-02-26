#!/bin/bash

# Ensure fzf is installed
if ! command -v fzf &> /dev/null; then
  echo "Error: fzf is not installed. Please install it using: sudo apt install fzf (Linux) or brew install fzf (Mac)."
  exit 1
fi

# Get the list of available environments (folder names inside 'environments')
env_dir="environments"
if [ ! -d "$env_dir" ]; then
  echo "Error: The '$env_dir' directory does not exist."
  exit 1
fi

env_options=($(ls -d $env_dir/*/ 2>/dev/null | xargs -n 1 basename))
if [ ${#env_options[@]} -eq 0 ]; then
  echo "Error: No environments found in '$env_dir'."
  exit 1
fi

# Prompt the user to select an environment using fzf
env_choice=$(printf "%s\n" "${env_options[@]}" | fzf --height=10 --prompt="Select an environment: ")

# Check if the user made a valid selection
if [ -z "$env_choice" ]; then
  echo "No environment selected. Exiting."
  exit 1
fi

env_path="./$env_dir/$env_choice"

file_options=($(ls -p "$env_path" | grep -v /))
if [ ${#file_options[@]} -eq 0 ]; then
  echo "Error: No environment files found in '$env_path'."
  exit 1
fi

# Prompt the user to select a file using fzf
env_file=$(printf "%s\n" "${file_options[@]}" | fzf --height=10 --prompt="Select an environment file: ")

# Check if the user made a valid selection
if [ -z "$env_file" ]; then
  echo "No environment file selected. Exiting."
  exit 1
fi

env_file_path="$env_path/$env_file"

# Extract the project name from environment choice and file name (without .env extension)
project_name="${env_choice}_$(basename "$env_file" .env)"

echo $env_file_path

# Prompt the user to select an action using fzf
action=$(printf "Deploy\nRemove" | fzf --height=3 --prompt="Select an action: ")

# Execute the selected action
case $action in
  Deploy ) docker compose -p "$project_name" --env-file="$env_file_path" up -d;;
  Remove ) docker compose -p "$project_name" --env-file="$env_file_path" down;;
  * ) echo "Invalid option. Exiting."; exit 1;;
esac

