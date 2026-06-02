# 白噪音文件

心流计时器从 `/sounds/<id>.mp3` 加载音频。需要在本目录放置以下文件:

| id | 标签 | 文件名 |
|---|---|---|
| `thunderstorm` | 雷雨交夹,窝在沙发 | `thunderstorm.mp3` |
| `rain-pipa` | 雨打琵琶,窗前写作 | `rain-pipa.mp3` |
| `ocean` | 海边听浪,放松身心 | `ocean.mp3` |
| `spring` | 春暖花开,阳台看书 | `spring.mp3` |
| `snow` | 大雪飘飘,烤火练字 | `snow.mp3` |
| —(完成提示)| chime | `chime.mp3` |

文件存在才会播放;**缺失的文件不会让 app 崩溃**,只是选中后听不到声音。

---

## 推荐:免版权资源

最稳妥的来源(可商用、可分发):

- [Mixkit](https://mixkit.co/free-sound-effects/) — 搜 `rain ambience`、`coffee shop`、`forest`
- [Pixabay Sound Effects](https://pixabay.com/sound-effects/) — 搜 `white noise`、`fireplace`
- [Freesound.org](https://freesound.org/) — 注意 license,部分需要署名

下载后重命名为上表对应的文件名,丢进本目录即可。

---

## 备选:从 bilibili 提取(仅个人本地使用)

bilibili 上有大量「白噪音 4 小时」类视频。版权属于 up 主,**仅适合本地个人使用,不可分发**。

```bash
# 装好工具(已装可跳)
brew install yt-dlp ffmpeg

# 下载并提取 mp3
yt-dlp -x --audio-format mp3 --audio-quality 0 \
  -o "rain.%(ext)s" \
  "https://www.bilibili.com/video/BV........"

# 截取 60 秒并加 2s 淡入淡出(适合循环):
ffmpeg -i rain.mp3 -t 60 \
  -af "afade=t=in:st=0:d=2,afade=t=out:st=58:d=2" \
  rain_loop.mp3
mv rain_loop.mp3 rain.mp3
```

如果 yt-dlp 抱怨 bilibili 验证或 SESSDATA,可以用 `--cookies-from-browser chrome`(或 safari/firefox)从浏览器读 cookie。

---

## 体积建议

- 单个 60-90 秒 mp3,128-192 kbps:约 1-2 MB
- 6 个文件总计 ~10 MB,打进 .app 不影响启动速度
- 如果想省空间,选 ogg 或更低码率(64 kbps 对环境音足够)

---

## chime.mp3

完成提示音,推荐 200-500ms 短促铃声。Mixkit 搜 `soft chime`、`bell ding`、`success` 都行。
