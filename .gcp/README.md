# Federator deployment

You (may) have many options to deploy the federator (in the future)

## On Google Cloud Run (with terraform)

There is infrastructure ready code to deploy the federator on cloud run, you just have to follow the steps below

### Setup a Google Platform Project and APIs

Create a project on Google Cloud Provider;
Enable payment;
[Enable Artifact Registry API](https://cloud.google.com/artifact-registry/docs/enable-service#console);
Enable PubSub API ();
Enable Cloud Run API;

### Deploy your artifacts to the artifact registry

Go to https://console.cloud.google.com/artifacts?project=<<your-project>>
Create repository
Format: Docker

docker push <<repository-location>>-docker.pkg.dev/<<your-project>>/<<repository-name>>/hathor-wallet-headless:latest
docker push <<repository-location>>-docker.pkg.dev/<<your-project>>/<<repository-name>>/hathor-tokenbridge:latest

### Run the deployment

You can run it from a remote repository like github, or locally

#### Remote repository - unavailable

#### Locally

Install terraform
Setup your variable files (copy .gcp/federator.tfvars.example and replace the values)
terraform apply --var-file=<<your-var-file-name.tfvars>>

## On AWS (with terraform) - unavailable

## On Azure (with terraform) - unavailable