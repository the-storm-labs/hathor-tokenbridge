provider "google" {
  project = "hathor-coordinator"
}

variable "wallet_container_name" {
  type = string
}

variable "wallet_seed" {
  type = string
}

variable "wallet_network" {
  type = string
}

variable "wallet_server" {
  type = string
}

variable "wallet_multisig_max_signatures" {
  type = number
}

variable "wallet_multisig_num_signatures" {
  type = number
}

variable "wallet_pubkeys" {
  type = string
}

variable "wallet_debug_long" {
  type = string
}

variable "wallet_enabled_plugins" {
  type = string
}

variable "wallet_plugin_name" {
  type = string
}

variable "wallet_plugin_file" {
  type = string
}

variable "wallet_plugin_pubsub_project" {
  type = string
}

variable "wallet_plugin_pubsub_topic" {
  type = string
}

variable "federator_container_name" {
  type = string
}

variable "federator_key" {
  type = string
}

variable "etherscan_key" {
  type = string
}

variable "evm_config" {
  type = string
}

variable "htr_config" {
  type = string
}

resource "google_pubsub_topic" "hathor-topic" {
  name = var.wallet_plugin_pubsub_topic
}

resource "google_cloud_run_v2_service" "hathor-wallet" {
  name     = var.wallet_container_name
  location = "us-central1"
  client   = "terraform"

  template {
    containers {
      image = "us-central1-docker.pkg.dev/hathor-coordinator/hathor/hathor-wallet-pubsub:v1.0.1.5"

      env {
        name  = "HEADLESS_SEED_DEFAULT"
        value = var.wallet_seed
      }
      env {
        name  = "HEADLESS_NETWORK"
        value = var.wallet_network
      }
      env {
        name  = "HEADLESS_SERVER"
        value = var.wallet_server
      }
      env {
        name  = "HEADLESS_MULTISIG_SEED_DEFAULT_MAX_SIGNATURES"
        value = var.wallet_multisig_max_signatures
      }
      env {
        name  = "HEADLESS_MULTISIG_SEED_DEFAULT_NUM_SIGNATURES"
        value = var.wallet_multisig_num_signatures
      }
      env {
        name  = "HEADLESS_MULTISIG_SEED_DEFAULT_PUBKEYS"
        value = var.wallet_pubkeys
      }
      env {
        name  = "HEADLESS_ENABLED_PLUGINS"
        value = var.wallet_enabled_plugins
      }
      env {
        name  = "HEADLESS_PLUGIN_DEBUG_LONG"
        value = var.wallet_debug_long
      }
      env {
        name  = "HEADLESS_PLUGIN_PUBSUB_NAME"
        value = var.wallet_plugin_name
      }
      env {
        name  = "HEADLESS_PLUGIN_PUBSUB_FILE"
        value = var.wallet_plugin_file
      }
      env {
        name  = "HEADLESS_PLUGIN_PUBSUB_PROJECT"
        value = var.wallet_plugin_pubsub_project
      }
      env {
        name  = "HEADLESS_PLUGIN_PUBSUB_TOPIC_NAME"
        value = var.wallet_plugin_pubsub_topic
      }
      ports {
        name           = "http1"
        container_port = 8000
      }
      startup_probe {
        failure_threshold     = 5
        initial_delay_seconds = 30
        timeout_seconds       = 3
        period_seconds        = 10
        http_get {
          path = "/"
          port = 8000
        }
      }
      liveness_probe {
        http_get {
          path = "/"
          port = 8000
        }
        initial_delay_seconds = 30
        period_seconds        = 60
      }
      resources {
        cpu_idle = false
        limits = {
          memory = "4Gi"
        }
      }
    }

    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }
  }

  depends_on = [google_pubsub_topic.hathor-topic]
}

locals {
  updated_htr_config = replace(var.htr_config, "placeholder_for_url", google_cloud_run_v2_service.hathor-wallet.uri)
}

resource "google_cloud_run_v2_service" "hathor-federator" {
  name     = var.federator_container_name
  location = "us-central1"
  client   = "terraform"

  template {
    containers {
      image = "us-central1-docker.pkg.dev/hathor-coordinator/hathor/token-bridge:v0.9.1.7"

      env {
        name  = "EVM_CONFIG"
        value = var.evm_config
      }
      env {
        name  = "HTR_CONFIG"
        value = local.updated_htr_config
      }
      env {
        name  = "FEDERATOR_KEY"
        value = var.federator_key
      }
      env {
        name  = "ETHERSCAN_KEY"
        value = var.etherscan_key
      }
      ports {
        name           = "http1"
        container_port = 8000
      }
      startup_probe {
        failure_threshold     = 5
        initial_delay_seconds = 30
        timeout_seconds       = 3
        period_seconds        = 10
        http_get {
          path = "/isAlive"
          port = 5000
        }
      }
      liveness_probe {
        http_get {
          path = "/isAlive"
          port = 5000
        }
        initial_delay_seconds = 30
        period_seconds        = 60
      }
      resources {
        cpu_idle = false
        limits = {
          memory = "4Gi"
        }
      }
    }

    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }
  }

  depends_on = [google_pubsub_topic.hathor-topic, google_cloud_run_v2_service.hathor-wallet]
}

resource "google_cloud_run_v2_service_iam_member" "noauth" {
  location = google_cloud_run_v2_service.hathor-wallet.location
  name     = google_cloud_run_v2_service.hathor-wallet.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}