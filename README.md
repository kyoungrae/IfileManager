# IFile Manager

로그인한 사용자만 이동식 디스크의 파일을 업로드·다운로드하고 폴더를 만들거나 삭제할 수 있는 단일 컨테이너 웹 서비스입니다. 업로드 파일은 이동식 디스크에 AES-256-GCM으로 암호화되어 저장되고, MongoDB의 파일명·MIME 타입·경로·감사 로그·사용자명도 암호화합니다. 비밀번호는 bcrypt 해시로만 보관합니다.

## 동작 원칙

- 이 서비스는 MongoDB 컨테이너를 만들지 않습니다. 이미 운영 중인 MongoDB의 **별도 `ifile_manager` 데이터베이스와 전용 DB 사용자**에 접속합니다.
- 호스트의 이동식 디스크는 `REMOVABLE_DISK_PATH/ifile-manager`만 컨테이너의 `/data`에 마운트합니다. 컨테이너는 그 밖의 호스트 경로를 제어하지 못합니다.
- 업로드 파일은 `files/<UUID>.ifm` 형식의 암호문입니다. 원래 파일명은 MongoDB에 암호화되어 있으므로 디스크를 직접 열어도 내용을 읽거나 이름을 알 수 없습니다.
- 폴더 삭제는 현재 로그인한 사용자의 비밀번호를 다시 검증해 5분짜리 단회성 확인 토큰을 발급한 후에만 수행됩니다. 루트 폴더 및 심볼릭 링크는 삭제할 수 없습니다.

## 운영 MongoDB 준비

현재 운영 중인 MongoDB에 관리자로 접속해 전용 DB 사용자를 만드세요. 실제 사용자명·강력한 비밀번호로 바꿔야 합니다.

```javascript
use ifile_manager
db.createUser({
  user: "ifile_manager",
  pwd: "REPLACE_WITH_A_LONG_RANDOM_PASSWORD",
  roles: [{ role: "readWrite", db: "ifile_manager" }]
})
```

`docker ps`에 보인 MongoDB 중 하나를 고르되, 이 서비스의 DB/계정은 기존 애플리케이션의 DB/계정과 분리하세요. 예를 들어 MongoDB가 호스트의 `127.0.0.1:27018`으로 공개되어 있다면 컨테이너용 URI는 다음처럼 설정합니다. Docker Desktop에서는 `host.docker.internal`이 호스트를 가리킵니다.

```dotenv
MONGODB_URI=mongodb://ifile_manager:비밀번호@host.docker.internal:27018/ifile_manager?authSource=ifile_manager
```

MongoDB가 다른 Compose 네트워크에만 있고 호스트 포트가 없다면, 해당 Mongo 컨테이너의 Compose 네트워크를 이 서비스에 external network로 추가한 뒤 서비스 DNS 이름을 URI에 사용하세요. 기존 MongoDB 컨테이너를 새로 만들거나 재시작하지 마세요.

## 최초 배포

집의 Docker 호스트에서 저장소를 받은 뒤, 비밀값 파일을 Git 밖에 만듭니다.

```bash
git clone https://github.com/kyoungrae/IfileManager.git
cd IfileManager
mkdir -p /opt/ifile-manager
cp .env.example /opt/ifile-manager/.env
chmod 600 /opt/ifile-manager/.env
```

`/opt/ifile-manager/.env`에서 `MONGODB_URI`, `REMOVABLE_DISK_PATH`, 두 개의 키, 최초 관리자 정보를 반드시 수정합니다. 키는 다음 명령으로 각각 생성합니다.

```bash
openssl rand -base64 32
openssl rand -base64 32
```

첫 번째 값은 `DATA_ENCRYPTION_KEY`, 두 번째 값은 `JWT_SECRET`에 넣습니다. `DATA_ENCRYPTION_KEY`를 잃어버리면 기존 업로드 파일은 복호화할 수 없으므로 비밀 관리자에 별도 백업하세요. 최초 관리자가 생성된 뒤 `BOOTSTRAP_ADMIN_PASSWORD`는 `.env`에서 제거할 수 있습니다.

배포 전 Docker Desktop 설정에서 이동식 디스크 경로(보통 `/Volumes/...`)를 File Sharing에 추가하고, 호스트에서 컨테이너가 쓸 전용 디렉터리를 만드세요.

```bash
mkdir -p "/Volumes/YourRemovableDisk/ifile-manager"
chmod 700 "/Volumes/YourRemovableDisk/ifile-manager"
```

다음으로 컨테이너를 실행합니다.

```bash
docker compose --env-file /opt/ifile-manager/.env up -d --build
docker compose --env-file /opt/ifile-manager/.env ps
curl http://127.0.0.1:4300/health
```

서비스는 기본적으로 `127.0.0.1:4300`에만 열립니다. 집의 Caddy/Nginx/Traefik에서 HTTPS 도메인으로 역방향 프록시하고 `COOKIE_SECURE=true`를 유지하세요. 공인 인터넷에 4300 포트를 직접 공개하지 마세요.

Tailscale IP로 HTTP 포트를 직접 열어야 한다면 `.env`에서 `PUBLIC_BIND_IP=100.x.y.z`와 `COOKIE_SECURE=false`를 함께 설정합니다. 이 경우 Docker는 해당 Tailscale 인터페이스에만 바인딩되지만, 브라우저 HTTPS는 제공되지 않습니다. HTTPS가 필요한 운영 환경에서는 Tailscale Serve 또는 역방향 프록시 구성을 권장합니다.

## Jenkins + GitHub 자동 배포

Jenkins 작업 `ifile-manager-deploy`은 GitHub의 `main` 브랜치를 2분 이내 주기로 확인합니다. 새 커밋이 감지되면 해당 커밋의 `Jenkinsfile`을 읽어 **테스트 → 이미지 빌드 → 컨테이너 교체 → 헬스 체크**를 순서대로 실행합니다. 이미 배포한 커밋은 건너뜁니다. 따라서 `main`에 커밋·푸시만 하면 됩니다. Jenkins를 외부에 공개하지 않으므로 GitHub 웹훅이나 추가 Funnel 설정은 필요하지 않습니다.

- Jenkins의 영구 볼륨에만 배포용 환경 파일을 `/var/jenkins_home/ifile-manager.env`로 보관합니다. 이 파일은 원격 서버의 IFileManager `.env` 사본이며 Git에 넣지 않습니다.
- Jenkins 컨테이너는 Docker socket을 통해 이미지를 빌드하고 Compose를 실행합니다. `REMOVABLE_DISK_PATH`는 기존 원격 `.env` 값을 그대로 사용합니다.
- 실패 시 기존 컨테이너는 교체되지 않으며 Jenkins 콘솔에서 어느 단계가 실패했는지 확인할 수 있습니다.
- 저장소가 private으로 전환되면 Jenkins 작업의 clone 단계에 GitHub 읽기 전용 Credentials를 추가해야 합니다.

## 개발 점검

```bash
cp .env.example .env
# .env의 placeholder를 실제 테스트값으로 바꾼 뒤
npm ci
npm test
docker compose config
```

운영 배포 전에 HTTPS 프록시, MongoDB 백업, 암호화 키 백업, 그리고 이동식 디스크의 안정적인 마운트 경로를 확인하세요.
