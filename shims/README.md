# shims

Этот каталог добавляется в PATH контейнеров n8n и worker.

Он позволяет:
- использовать ffmpeg, yt-dlp, python
- не пересобирать Dockerfile при обновлениях
- полностью повторить прод-сервер

## Требования на хосте

На сервере должны быть установлены:
- ffmpeg
- python3
- yt-dlp

### Пример (Ubuntu)

```bash
apt update
apt install -y ffmpeg python3 python3-pip
pip3 install yt-dlp
