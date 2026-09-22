// This file is loaded by the small bootstrap job stored in Jenkins.
// Keeping the build and deployment logic in Git makes every deployment auditable.
def runPipeline = {
  properties([
    disableConcurrentBuilds(),
    buildDiscarder(logRotator(daysToKeepStr: '14', numToKeepStr: '30'))
  ])

  timestamps {
    withEnv([
      // Match the existing Compose project's label so Jenkins replaces its container.
      'COMPOSE_PROJECT_NAME=ifilemanager',
      "DEPLOY_ENV_FILE=${env.JENKINS_HOME}/ifile-manager.env",
      "IMAGE_TAG=${env.BUILD_NUMBER}"
    ]) {
      stage('Verify') {
        sh '''#!/bin/sh
          set -eu
          test -r "$DEPLOY_ENV_FILE"
          docker version
          docker compose version
          docker compose --env-file "$DEPLOY_ENV_FILE" config --quiet
          docker build --target test -t "ifile-manager/verify:$IMAGE_TAG" .
        '''
      }

      stage('Build image') {
        sh '''#!/bin/sh
          set -eu
          docker compose --env-file "$DEPLOY_ENV_FILE" build
        '''
      }

      stage('Deploy') {
        sh '''#!/bin/sh
          set -eu
          docker compose --env-file "$DEPLOY_ENV_FILE" up -d --no-build --force-recreate --remove-orphans --wait
          docker compose --env-file "$DEPLOY_ENV_FILE" ps
        '''
      }

      stage('Health check') {
        sh '''#!/bin/sh
          set -eu
          test "$(docker inspect --format '{{.State.Health.Status}}' ifile-manager)" = healthy
        '''
      }
    }
  }
}

return runPipeline
