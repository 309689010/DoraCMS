const BaseComponent = require('../prototype/baseComponent')
const ContentTemplateModel = require('../models').ContentTemplate
const TemplateItemsModel = require('../models').TemplateItems
const formidable = require('formidable')
const { service, validatorUtil, siteFunc } = require('../../../utils')
const cache = require('../../../utils/middleware/cache')
const settings = require('../../../configs/settings')
const shortid = require('shortid')
const validator = require('validator')
const _ = require('lodash')
const axios = require('axios')
const unzip = require('unzip2')
const fs = require('fs')
const iconv = require('iconv-lite')
const http = require('http')
const url = require('url')

function setTempData(res, targetTemp) {
  let tempTree = []
  tempTree.push({
    id: 'i18n',
    parentId: 0,
    name: res.__('label_tempconfig_tree_i18n'),
    open: false
  })
  tempTree.push({
    id: 'public',
    parentId: 0,
    name: res.__('label_tempconfig_tree_common_temp'),
    open: false
  })
  tempTree.push({
    id: 'users',
    parentId: 0,
    name: res.__('label_tempconfig_tree_users_temp'),
    open: true
  })
  tempTree.push({
    id: 'styles',
    parentId: 0,
    name: res.__('label_tempconfig_tree_styles_temp'),
    open: true
  })
  tempTree.push({
    id: 'js',
    parentId: 0,
    name: res.__('label_tempconfig_tree_script_temp'),
    open: true
  })

  // 读取ejs模板
  let newPubPath = siteFunc.setTempParentId(
    service.scanFolder(settings.SYSTEMTEMPFORDER, targetTemp + '/public'),
    'public'
  )
  const newUserPath = siteFunc.setTempParentId(
    service.scanFolder(settings.SYSTEMTEMPFORDER, targetTemp + '/users'),
    'users'
  )
  newPubPath = newPubPath.concat(newUserPath)
  // 读取国际化
  const newI18nPath = siteFunc.setTempParentId(
    service.scanFolder(process.cwd(), '/locales'),
    'i18n'
  )
  newPubPath = newPubPath.concat(newI18nPath)
  // 读取静态文件
  if (fs.existsSync(settings.TEMPSTATICFOLDER + targetTemp)) {
    const newStylePath = siteFunc.setTempParentId(
      service.scanFolder(settings.TEMPSTATICFOLDER, targetTemp + '/css'),
      'styles'
    )
    const newJsPath = siteFunc.setTempParentId(
      service.scanFolder(settings.TEMPSTATICFOLDER, targetTemp + '/js'),
      'js'
    )
    newPubPath = newPubPath.concat(newStylePath).concat(newJsPath)
  }
  // 读取模板单元
  const filePath = service.scanJustFolder(
    settings.SYSTEMTEMPFORDER + targetTemp
  )
  let tempUnit = []
  tempUnit.push({
    id: 'tempUnit',
    parentId: 0,
    name: res.__('label_tempconfig_tree_script_tempUnit'),
    open: true
  })
  for (let i = 0; i < filePath.length; i++) {
    const fileObj = filePath[i]
    if (fileObj.name.split('-')[1] === 'stage') {
      tempUnit.push({
        id: fileObj.name,
        parentId: 'tempUnit',
        name: fileObj.name,
        open: true
      })
      const unitArr = service.scanFolder(
        settings.SYSTEMTEMPFORDER,
        targetTemp + '/' + fileObj.name
      )
      const newUnitArr = siteFunc.setTempParentId(unitArr, fileObj.name)
      tempUnit = tempUnit.concat(newUnitArr)
    }
  }
  if (tempUnit.length > 0) {
    newPubPath = newPubPath.concat(tempUnit)
  }

  // 读取根目录下的所有文件
  const rootArr = service.scanFolder(settings.SYSTEMTEMPFORDER, targetTemp)
  const newRootArr = []
  for (let j = 0; j < rootArr.length; j++) {
    const rootObj = rootArr[j]

    if (rootObj.type === 'html') {
      const rootFile = siteFunc.setTempParentId(rootObj, 0)
      rootFile.parentId = 0
      newRootArr.push(rootFile)
    }
  }
  if (newRootArr.length > 0) {
    newPubPath = newPubPath.concat(newRootArr)
  }

  tempTree = tempTree.concat(newPubPath)
  tempTree.sort()
  // console.log('----tempTree---', tempTree)
  return tempTree
}

function getDefaultTempInfo() {
  return new Promise((resolve, reject) => {
    cache.get(
      settings.session_secret + '_default_temp',
      async defaultTempData => {
        if (defaultTempData) {
          resolve(defaultTempData)
        } else {
          try {
            const defaultTemp = await ContentTemplateModel.findOne({
              using: true
            })
              .populate('items')
              .exec()
            if (!_.isEmpty(defaultTemp)) {
              // 缓存1天
              cache.set(
                settings.session_secret + '_default_temp',
                defaultTemp,
                1000 * 60 * 60 * 24
              )
              resolve(defaultTemp)
            } else {
              resolve([])
            }
          } catch (error) {
            resolve([])
          }
        }
      }
    )
  })
}

function checkFormData(req, res, fields) {
  let errMsg = ''

  if (!validator.isLength(fields.name, 1, 12)) {
    errMsg = res.__('validate_rangelength', {
      min: 1,
      max: 12,
      label: res.__('label_tempconfig_name')
    })
  }
  if (!validator.isLength(fields.forder, 1, 30)) {
    errMsg = res.__('validate_rangelength', {
      min: 1,
      max: 30,
      label: res.__('label_tempconfig_forder')
    })
  }
  if (!validator.isLength(fields.comments, 2, 30)) {
    errMsg = res.__('validate_rangelength', {
      min: 2,
      max: 30,
      label: res.__('label_comments')
    })
  }
  if (errMsg) {
    throw new siteFunc.UserException(errMsg)
  }
}

function checkDistForder(targetPath, forderArr) {
  return new Promise((resolve, reject) => {
    const checkState = siteFunc.checkExistFile(
      service.scanJustFolder(targetPath),
      forderArr
    )
    if (checkState) {
      resolve()
    } else {
      const checkTimer = setInterval(() => {
        if (
          siteFunc.checkExistFile(service.scanJustFolder(targetPath), forderArr)
        ) {
          clearInterval(checkTimer)
          resolve()
        }
      }, 2000)
    }
  })
}
class ContentTemplate {
  async getMyTemplateList(req, res, next) {
    try {
      const temps = await ContentTemplateModel.find({})
        .populate('items')
        .exec()
      const renderData = siteFunc.renderApiData(
        res,
        200,
        'ContentTemplate',
        temps,
        'getlist'
      )
      res.send(renderData)
    } catch (err) {
      res.send(siteFunc.renderApiErr(req, res, 500, err, 'getlist'))
    }
  }

  async getCurrentTempInfo(req, res, next) {
    try {
      const defaultTemp = await getDefaultTempInfo()
      const renderData = siteFunc.renderApiData(
        res,
        200,
        'ContentTemplate',
        defaultTemp,
        'getlist'
      )

      return renderData
    } catch (err) {
      res.send(siteFunc.renderApiErr(req, res, 500, err, 'getlist'))
    }
  }
  async getContentDefaultTemplate(req, res, next) {
    try {
      const defaultTemp = await ContentTemplateModel.findOne({
        using: true
      })
        .populate('items')
        .exec()
      // console.log('--defaultTemp---', defaultTemp)
      const tempTree = setTempData(res, defaultTemp.alias)
      const renderData = siteFunc.renderApiData(
        res,
        200,
        'ContentTemplate',
        {
          docs: tempTree
        },
        'getlist'
      )
      res.send(renderData)
    } catch (err) {
      res.send(siteFunc.renderApiErr(req, res, 500, err, 'getlist'))
    }
  }

  async getFileInfo(req, res, next) {
    const filePath = req.query.filePath
    if (filePath && filePath.indexOf('../') >= 0) {
      res.send(siteFunc.renderApiErr(req, res, 500, 'no power', 'getlist'))
    } else {
      const path = siteFunc.getTempBaseFile(filePath) + filePath
      if (path) {
        try {
          const fileData = await service.readFile(req, res, path)
          const renderData = siteFunc.renderApiData(
            res,
            200,
            'ContentTemplateFile',
            {
              doc: fileData,
              path: filePath
            },
            'getlist'
          )
          res.send(renderData)
        } catch (error) {
          res.send(siteFunc.renderApiErr(req, res, 500, error, 'getlist'))
        }
      } else {
        res.send(siteFunc.renderApiErr(req, res, 500, 'no power', 'getlist'))
      }
    }
  }

  async updateFileInfo(req, res, next) {
    const fileContent = req.query.code
    const filePath = req.query.path
    if ((filePath && filePath.indexOf('../') >= 0) || !fileContent) {
      res.send(siteFunc.renderApiErr(req, res, 500, 'no power', 'getlist'))
    } else {
      const path = siteFunc.getTempBaseFile(filePath) + filePath
      if (path) {
        const writeState = service.writeFile(req, res, path, fileContent)
        if (writeState === 200) {
          res.send(
            siteFunc.renderApiData(
              res,
              200,
              'ContentTemplateFileUpdate',
              {},
              'update'
            )
          )
        } else {
          res.send(
            siteFunc.renderApiErr(req, res, 500, 'no path file', 'getlist')
          )
        }
      } else {
        res.send(siteFunc.renderApiErr(req, res, 500, 'no power', 'getlist'))
      }
    }
  }

  async getTempItemForderList(req, res, next) {
    try {
      const defaultTemp = await getDefaultTempInfo()
      // console.log('--defaultTemp----', defaultTemp)
      const filePath = service.scanJustFolder(
        settings.SYSTEMTEMPFORDER + defaultTemp.alias
      )
      const newFilePath = _.filter(filePath, file => {
        return file.name.indexOf('stage') >= 0
      })
      // 对返回结果做初步排序
      newFilePath.sort(function(a, b) {
        return a.type === 'folder' || b.type === 'folder'
      })
      res.send(
        siteFunc.renderApiData(
          res,
          200,
          'ContentTemplateForder',
          newFilePath,
          'getlist'
        )
      )
    } catch (error) {
      res.send(siteFunc.renderApiErr(req, res, 500, error, 'getlist'))
    }
  }

  async addTemplateItem(req, res, next) {
    const form = new formidable.IncomingForm()
    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.log(err)
      }
      try {
        checkFormData(req, res, fields)
      } catch (err) {
        res.send(siteFunc.renderApiErr(req, res, 500, err, 'checkform'))
      }

      const tempItemObj = {
        name: fields.name,
        forder: fields.forder,
        isDefault: fields.isDefault,
        comments: fields.comments
      }

      const newContentTemplateItems = new TemplateItemsModel(tempItemObj)
      try {
        await newContentTemplateItems.save()
        const defaultTemp = await getDefaultTempInfo()
        await ContentTemplateModel.findOneAndUpdate(
          {
            _id: defaultTemp._id
          },
          {
            $push: {
              items: newContentTemplateItems._id
            }
          }
        )
        res.send(
          siteFunc.renderApiData(
            res,
            200,
            'ContentTemplateItems',
            {
              id: newContentTemplateItems._id
            },
            'save'
          )
        )
      } catch (err) {
        res.send(siteFunc.renderApiErr(req, res, 500, err, 'save'))
      }
    })
  }

  async delTemplateItem(req, res, next) {
    try {
      let errMsg = ''
      if (!siteFunc.checkCurrentId(req.query.ids)) {
        errMsg = res.__('validate_error_params')
      }
      if (errMsg) {
        throw new siteFunc.UserException(errMsg)
      }

      const defaultTemp = await getDefaultTempInfo()
      await ContentTemplateModel.findOneAndUpdate(
        {
          _id: defaultTemp._id
        },
        {
          $pull: {
            items: req.query.ids
          }
        }
      )

      await TemplateItemsModel.remove({
        _id: req.query.ids
      })
      res.send(
        siteFunc.renderApiData(res, 200, 'contentTemplateItems', {}, 'delete')
      )
    } catch (err) {
      res.send(siteFunc.renderApiErr(req, res, 500, err, 'delete'))
    }
  }

  async getTempsFromShop(req, res, next) {
    const current = req.query.current || 1
    const pageSize = req.query.limit || 10
    const searchkey = req.query.searchkey

    const linkParams = `?limit=${pageSize}&currentPage=${current}`
    try {
      const templateList = await axios.get(
        settings.DORACMSAPI + '/system/template' + linkParams
      )
      if (templateList.status === 200) {
        res.send(
          siteFunc.renderApiData(
            res,
            200,
            'contentTemplates',
            templateList.data,
            'getlist'
          )
        )
      } else {
        res.send(siteFunc.renderApiErr(req, res, 500, 'error', 'getlist'))
      }
    } catch (error) {
      res.send(siteFunc.renderApiErr(req, res, 500, error, 'getlist'))
    }
  }

  async installTemp(req, res, next) {
    const tempId = req.query.tempId
    try {
      if (tempId) {
        const templateInfo = await axios.get(
          settings.DORACMSAPI + '/system/template/getItem?tempId=' + tempId
        )
        if (templateInfo.status === 200) {
          // console.log('----templateInfo---', templateInfo)
          const tempObj = templateInfo.data
          if (_.isEmpty(tempObj)) {
            throw new siteFunc.UserException(res.__('validate_error_params'))
          }
          const file_url = tempObj.filePath
          const file_targetForlder = tempObj.alias
          const DOWNLOAD_DIR =
            settings.SYSTEMTEMPFORDER + file_targetForlder.trim() + '/'
          const target_path =
            DOWNLOAD_DIR +
            url
              .parse(file_url)
              .pathname.split('/')
              .pop()
          // console.log('------target_path----', target_path)
          if (fs.existsSync(DOWNLOAD_DIR)) {
            throw new siteFunc.UserException('您已安装该模板')
          }

          fs.mkdir(DOWNLOAD_DIR, function(err) {
            if (err) {
              console.log(err)
              throw new siteFunc.UserException(err)
            } else {
              download_file_httpget(file_url, async () => {
                // 下载完成后解压缩
                const extract = unzip.Extract({
                  path: DOWNLOAD_DIR
                })
                extract.on('error', function(err) {
                  console.log(err)
                  // 解压异常处理
                  throw new siteFunc.UserException(err)
                })
                extract.on('finish', async () => {
                  console.log('解压完成!!')
                  // 解压完成处理入库操作
                  const tempItem = new TemplateItemsModel({
                    forder: '2-stage-default',
                    name: 'Default',
                    isDefault: true
                  })
                  const newTempItem = await tempItem.save()

                  const newTemp = new ContentTemplateModel(tempObj)
                  newTemp.using = false
                  newTemp.items.push(newTempItem._id)
                  await newTemp.save()

                  // 复制静态文件到公共目录
                  await checkDistForder(
                    settings.SYSTEMTEMPFORDER + tempObj.alias + '/dist',
                    ['images', 'css', 'js']
                  )
                  const fromPath =
                    settings.SYSTEMTEMPFORDER + tempObj.alias + '/dist/'
                  const targetPath = settings.TEMPSTATICFOLDER + tempObj.alias

                  service.copyForder(fromPath, targetPath)

                  res.send(
                    siteFunc.renderApiData(
                      res,
                      200,
                      'contentTemplates',
                      {},
                      'getlist'
                    )
                  )
                })
                fs.createReadStream(target_path).pipe(extract)
              })
            }
          })

          // 文件下载
          const download_file_httpget = function(file_url, callBack) {
            const options = {
              host: url.parse(file_url).host,
              port: 80,
              path: url.parse(file_url).pathname
            }

            const file_name = url
              .parse(file_url)
              .pathname.split('/')
              .pop()
            const file = fs.createWriteStream(DOWNLOAD_DIR + file_name)

            http.get(options, function(res) {
              res
                .on('data', function(data) {
                  file.write(data)
                })
                .on('end', function() {
                  file.end()
                  setTimeout(() => {
                    callBack(DOWNLOAD_DIR)
                  }, 5000)
                })
            })
          }
        } else {
          res.send(siteFunc.renderApiErr(req, res, 500, 'error', 'getlist'))
        }
      } else {
        throw new siteFunc.UserException(res.__('validate_error_params'))
      }
    } catch (error) {
      res.send(siteFunc.renderApiErr(req, res, 500, error, 'getlist'))
    }
  }

  async enableTemp(req, res, next) {
    var tempId = req.query.tempId

    try {
      if (!tempId || !shortid.isValid(tempId)) {
        throw new siteFunc.UserException(res.__('validate_error_params'))
      }
      // 重置所有模板
      await ContentTemplateModel.update(
        {},
        {
          $set: {
            using: false
          }
        },
        {
          multi: true
        }
      )

      await ContentTemplateModel.findOneAndUpdate(
        {
          _id: tempId
        },
        {
          $set: {
            using: true
          }
        }
      )

      // 更新缓存
      const defaultTemp = await ContentTemplateModel.findOne({
        using: true
      })
        .populate('items')
        .exec()
      cache.set(
        settings.session_secret + '_default_temp',
        defaultTemp,
        1000 * 60 * 60 * 24
      )

      res.send(
        siteFunc.renderApiData(res, 200, 'enableTemplates', {}, 'update')
      )
    } catch (error) {
      res.send(siteFunc.renderApiErr(req, res, 500, error, 'update'))
    }
  }

  async uninstallTemp(req, res, next) {
    const tempId = req.query.tempId
    try {
      let errMsg = ''
      if (!siteFunc.checkCurrentId(tempId)) {
        errMsg = res.__('validate_error_params')
      }
      if (errMsg) {
        throw new siteFunc.UserException(errMsg)
      }

      const defaultTemp = await getDefaultTempInfo()
      if (defaultTemp._id === tempId) {
        throw new siteFunc.UserException('can not delete using template')
      } else {
        const targetTemp = await ContentTemplateModel.findOne({
          _id: tempId
        })
        // console.log('---targetTemp---', targetTemp)
        if (!_.isEmpty(targetTemp)) {
          await TemplateItemsModel.remove({
            _id: {
              $in: targetTemp.items
            }
          })
          await ContentTemplateModel.remove({
            _id: targetTemp._id
          })

          // 删除模板文件夹
          var tempPath = settings.SYSTEMTEMPFORDER + targetTemp.alias
          var tempStaticPath = settings.TEMPSTATICFOLDER + targetTemp.alias
          await service.deleteFolder(req, res, tempPath)
          await service.deleteFolder(req, res, tempStaticPath)
          res.send(
            siteFunc.renderApiData(res, 200, 'uninstallTemp', {}, 'update')
          )
        } else {
          throw new siteFunc.UserException(res.__('validate_error_params'))
        }
      }
    } catch (error) {
      res.send(siteFunc.renderApiErr(req, res, 500, error, 'update'))
    }
  }
}

module.exports = new ContentTemplate()
