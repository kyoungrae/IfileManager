// This file is loaded by the small bootstrap job stored in Jenkins.
// Keeping the build and deployment logic in Git makes every deployment auditable.
def runPipeline = {
  properties([
    pipelineTriggers([cron('H/2 * * * *')]),
    disableConcurrentBuilds(),
    buildDiscarder(logRotator(daysToKeepStr: '14', numToKeepStr: '30'))
  ])

  timestamps {
    withEnv([
      'COMPOSE_PROJECT_NAME=ifile-manager',
      "DEPLOY_ENV_FILE=${env.JENKINS_HOME}/ifile-manager.env",
      "IMAGE_TAG=${env.BUILD_NUMBER}",
      "DEPLOY_STATE_FILE=${env.JENKINS_HOME}/ifile-manager.last-deployed-commit"
    ]) {
      def commit = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
      def previousCommit = sh(script: 'test -r "$DEPLOY_STATE_FILE" && cat "$DEPLOY_STATE_FILE" || true', returnStdout: true).trim()
      if (commit == previousCommit) {
        echo "${commit} is already deployed; skipping build and deployment."
        currentBuild.result = 'NOT_BUILT'
      } else {
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
          docker compose --env-file "$DEPLOY_ENV_FILE" up -d --no-build --remove-orphans --wait
          docker compose --env-file "$DEPLOY_ENV_FILE" ps
        '''
      }

        stage('Health check') {
        sh '''#!/bin/sh
          set -eu
          test "$(docker inspect --format '{{.State.Health.Status}}' ifile-manager)" = healthy
          git rev-parse HEAD > "$DEPLOY_STATE_FILE"
          chmod 600 "$DEPLOY_STATE_FILE"
        '''
        }
      }
    }
  }
}

return runPipeline
