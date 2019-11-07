'use strict'

const _ = require('lodash')

class ModelBaseClass {
  static _init (options) {
    this._skip = 0
    this._page = 1
    this._limit = 50
    this._cache = false

    this.cacher = options.cacher
    this.resource = this.collection.name
  }

  static _create (data, options) {
    let model = new this()
    return model.set(data).save()
  }

  static _read (filter, options) {
    let select = _.get(options, 'select', '')
    let expand = _.get(options, 'expand', '')
    
    let query = this.findOne(filter)

    if (select) query.select(select)
    if (expand) query.populate(this.mapPopulates(expand))

    return query.exec()
  }

  static _update (filter, options ) {
    let expand = _.get(options, 'expand', '')
    let update = _.get(options, 'data', {})
    let soft = _.get(options, 'soft', false)

    let query = this.findOne(filter)

    // first  query to capture modified paths
    return query
      .exec()
      .then(doc => {
        if (!doc) return doc

        let oldDoc = _.cloneDeep(doc)

        if (typeof soft === 'boolean') {
          if (soft) { // soft array update (append new items to existing array)
            _.each(Object.keys(update), key => {
              if (Array.isArray(doc[key])) {
                doc[key] = Array.from(new Set([...doc[key], ...update[key]]))
              } else {
                doc[key] = update[key]
              }
            })
          } else { // hard array update (overwrite array values with new ones)
            _.each(Object.keys(update), key => {
              doc[key] = update[key]
            })
          }
        } else if (typeof soft === 'object') {
          // mixed! some fields are soft some are not
          _.each(Object.keys(update), key => {
            if (Array.isArray(update[key]) && soft[key]) {
              doc[key] = Array.from(new Set([...doc[key], ...update[key]]))
            } else {
              doc[key] = update[key]
            }
          })
        }

        let changeLog = {}
        let modifieds = doc.modifiedPaths()

        let comparator = function (a, b) {
          return typeof a === 'object'
            ? !_.isEqual(a, b)
            : a !== b
        }

        return doc.save().then(updDoc => {
          updDoc = updDoc.toObject()

          if (modifieds.length) {
            _.each(modifieds, field => {
              let updd = updDoc[field]
              let oldd = oldDoc[field]

              if (Array.isArray(updd) && updd.length && !_.isPlainObject(updd[0])) {
                changeLog[field] = {
                  added: updd.filter(a => oldd.every(b => comparator(a, b))),
                  removed: oldd.filter(b => updd.every(a => comparator(b, a)))
                }
              } else {
                changeLog[field] = {
                  from: oldd,
                  to: updd
                }
              }
            })

            updDoc.modifieds = modifieds
            updDoc.changeLog = changeLog
          }

          return updDoc
        })
      })
  }

  static _delete (filter) {
    return this.findOne(filter)
      .exec()
      .then(doc => {
        if (!doc) return doc
        return doc.remove()
      })
  }

  static _search (filter, options) {
    let { sort, page, expand, listOnly, docsPerPage: limit } = options
    
    let query = this.find(filter)
    let cquery = this.find(filter)
    
    page = page || this._page
    limit = limit || this._limit
    
    query.limit(limit)
    query.skip(limit * (page > 0 ? page - 1 : 0))

    if (!_.isEmpty(sort)) {
      query.collation({ locale: 'en' })
      query.sort(sort)
    }

    if (expand) query.populate(this.mapPopulates(expand))

    return query.exec()
      .then(docs => {
        if (listOnly) return docs

        return cquery.countDocuments()
          .then(count => {
            return {
              totalDocs: count,
              currentPage: page,
              docsPerPage: limit,
              totalPages: Math.ceil(count / limit),
              data: docs
            }
          })
      })
  }

  static _count (filter) {
    let cquery = this.find(filter)
    return cquery.countDocuments()
  }

  // -- BUG: once expanded and stored in cache, the expanded item is frozen
  // -- HOTFIX?: disabled caching
  // -- PLAN: do a manual expand, do not refer to mongoose `populate` function

  static mapPopulates (expands) {
    let exc = [
      'floor', 'jobErrors', 'data', 'spaces', 'floors', 'address', 'scopes', 'items',
      'invitees', 'suppliers', 'permissions', 'dimensions', 'emergencyContact'
    ]
  
    let obj = {}
  
    expands = expands.replace(/\s/g, '')
    expands = expands.replace(/\*/g, '.')
  
    _.each(expands.split(','), item => {
      _.set(obj, item, 1)
    })
  
    let bypass = function (obj, root) {
      let populate = []
  
      _.each(obj, (val, key) => {
        if (_.isNumber(val)) {
          populate.push({ path: `${root}.${key}` })
          delete obj[key]
        }
  
        if (_.isPlainObject(val)) {
          populate.push(convert(val, `${root}.${key}`))
        }
      })
  
      return { populate }
    }
  
    let convert = function (obj, root) {
      let populate = []
  
      _.each(obj, (val, key) => {
        if (_.isNumber(val)) {
          delete obj[key]
          if (!_.includes(exc, key)) {
            populate.push({ path: key })
          }
        }
      
        if (_.isPlainObject(val)) {
          if (!_.includes(exc, key)) {
            populate.push(convert(val, key))
          } else {
            let bp = bypass(val, key)
            populate = populate.concat(bp.populate)
          }
        }
      })
  
      let ret = { path: root }
      if (populate.length) ret.populate = populate
  
      return ret
    }
    
    let ret = convert(obj, 'root')
    return ret.populate
  }
}

module.exports = ModelBaseClass
