pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  environment {
    COMPOSE_PROJECT_NAME = 'ifile-manager'
    DEPLOY_ENV_FILE = '/opt/ifile-manager/.env'
    IMAGE_TAG = "${BUILD_NUMBER}"
  }

  stages {
    stage('Checkout') {
      steps { checkout scm }
    }
    stage('Verify') {
      steps {
        sh 'test -f "$DEPLOY_ENV_FILE"'
        sh 'docker build --target test -t ifile-manager/verify:${BUILD_NUMBER} .'
      }
    }
    stage('Deploy') {
      steps {
        sh '''
          docker compose --env-file "$DEPLOY_ENV_FILE" -f docker-compose.yml build
          docker compose --env-file "$DEPLOY_ENV_FILE" -f docker-compose.yml up -d --remove-orphans
          docker compose --env-file "$DEPLOY_ENV_FILE" -f docker-compose.yml ps
        '''
      }
    }
  }
}
