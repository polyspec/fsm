<!-- doc-id: readme-python -->
<!-- source-sha256: 23a7925c9b8adb5e6b465f6fedf097ddb7677814e4148b2b82b2f8f9ebfb6545 -->
# polyspec-status-python

[English](README.md)

status의 python 소비자다(`docs/plans/status-v1.md`, C-2). 이 패키지는 private이며 시험용 환경이므로 배포하지 않는다.
status 정의에서 생성된 python 코드를 어떻게 쓰는지 보여 주고, 그 코드가 conformance vector와 일치하는지 검사한다.

- `src/polyspec_status/`: `status-gen gen --kind python`이 생성한다(직접 고치지 않는다). `order.py`는 machine을 담는다. member가
  대문자인 `IntEnum`인 `State`와 `Event`, 동결된 dataclass `Step`, 그리고 `status.Error`를 던지는 여덟 함수다. `status.py`에는
  `Code` `StrEnum`과 `Error` 예외가 있고, `__init__.py`는 module을 내보낸다.
- `tests/vectors.py`: 모든 machine의 vector case로, `status-gen vectors --kind python`이 생성한다.
- `tests/test_conformance.py`: vector case마다 unittest method 하나를 두며, 이름은 `test_<feature>__<id>`이고, 생성된 함수의 결과나
  오류 code를 검사한다.
- `examples/persist.py`: `docs/spec/status.md`(B-4)의 persistence 패턴을 polyspec orm으로 SQLite에서 구현한다. persist case가
  이를 실행한다.
- `examples/model/models.py`: 루트 `schema/persist.dbs`에서 orm이 생성한 model이다.

## Python 3.14 환경

checkout은 `config/toolchain.json`(`"python": "3.14"`)에서 Python 3.14를 선언한다. 이 패키지는 시스템의 `python3`를 쓰지 않는다.
macOS의 `/usr/bin/python3`은 3.9이며, orm client는 Python 3.11 이상을 요구한다.

- `make install-python`(온라인, 루트에서 실행)은 uv로 Python 3.14를 설치하고 `var/tools/bin/python3`를 그것에 연결한다. 이 연결이
  유일한 변경이며 checkout 안에만 남는다. 시스템 경로는 바뀌지 않는다.
- `make install`(온라인)은 `PYTHON`이 이름 붙인 인터프리터(기본값은 루트의 `var/tools/bin/python3`의 절대 경로이며 PATH 조회가 아니다)로
  `.venv`를 만들고, 다른 minor release이면 거부하며, 이 패키지를 editable 모드와 의존성과 함께 설치한다. orm client는
  `pyproject.toml`에서 git tag `v0.0.7`로 고정된다.
  orm은 자신의 의존성을 정확히 고정하므로, 같은 tag에서 같은 패키지가 설치된다. build backend도 고정된다(`setuptools==84.0.0`).
  `.venv`는 gitignore 대상이다.
- `make test`(오프라인)는 `.venv/bin`을 `PATH`의 맨 앞에 두고 kit runner를 실행하며, runner는 `python3`를 시작한다. 이 `python3`는
  venv의 Python 3.14이므로 시험은 선언된 release에서 돈다. 이 target은 아무것도 만들지 않으며 네트워크가 필요 없다. `.venv`가
  없으면 실행을 거부한다.

## 깨끗한 checkout에서 재현

```sh
make install-python                      # online: Python 3.14 with uv, linked into var/tools/bin
make -C packages/status-python install   # online: the venv and the pinned dependencies
make test-python                         # offline: the 89 vector cases and the persist cases
```

생성 파일은 커밋되어 있으므로 `test`에는 generator가 필요 없다. `make -C packages/status-python gen`은 이를 다시 생성하며
(`install`이 필요하다), 루트의 `make gen-check`는 생성 파일이 최신인지 검사한다. `make parity-python`은 모든 case의 결과
기록을 검사한다.

이 kind에는 lock 파일을 커밋하지 않는다. C-2에 따라 python은 lock을 두지 않으며, 위의 정확한 고정이 의존성 트리를 정한다.

## 루트 gate와 PATH의 인터프리터

루트 Makefile은 `var/tools/bin`을 `PATH`의 맨 앞에 두므로, 루트의 `make toolchain-check`는 `make install-python`이 연결한 `python3`를
실행하고 그 release를 선언된 3.14와 비교한다. 시스템의 `python3`는 바뀌지 않으며, checkout 밖의 symbolic link도 필요 없다.
패키지 target은 같은 `var/tools/bin`을 쓴 뒤 venv를 쓴다.
